package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.dto.ClassroomCreateDTO;
import org.campus.classroom.dto.ClassroomUpdateDTO;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.Seat;
import org.campus.classroom.enums.ClassroomStatus;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.SeatStatus;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.service.ClassroomService;
import org.campus.classroom.vo.BuildingPreferenceVO;
import org.campus.classroom.vo.ClassroomVO;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class ClassroomServiceImpl implements ClassroomService {
    private final ClassroomMapper classroomMapper;
    private final SeatMapper seatMapper;
    private final ReservationMapper reservationMapper;

    @Transactional
    @Override
    public Long create(ClassroomCreateDTO request) {
        log.info("[开始创建教室] 教学楼={}, 教室号={}, 座位行数={}, 座位列数={}",
                request.getBuilding(), request.getRoomNumber(), request.getSeatRows(), request.getSeatCols());
        Classroom existing = classroomMapper.selectByBuildingAndNumber(request.getBuilding().trim(), request.getRoomNumber().trim());
        if (existing != null) {
            throw new BusinessException(ResultCode.CONFLICT, "该教学楼下教室名称已存在");
        }

        String status = request.getStatus();
        if (!StringUtils.hasText(status)) {
            status = ClassroomStatus.ENABLED.name();
        } else {
            status = status.trim();
            validateStatus(status);
        }

        Classroom classroom = new Classroom();
        classroom.setRoomNumber(request.getRoomNumber());
        classroom.setBuilding(request.getBuilding());
        classroom.setSeatRows(request.getSeatRows());
        classroom.setSeatCols(request.getSeatCols());
        classroom.setStatus(status);
        classroom.setRemark(request.getRemark());

        int rows = classroomMapper.insert(classroom);
        if (rows <= 0) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "创建失败");
        }

        for (int i = 1; i <= classroom.getSeatRows(); i++) {
            for (int j = 1; j <= classroom.getSeatCols(); j++) {
                Seat seat = new Seat();
                seat.setClassroomId(classroom.getId());
                seat.setSeatNumber(i + "-" + j);
                seat.setRowNumber(i);
                seat.setColNumber(j);
                seat.setStatus(SeatStatus.ENABLED.name());
                seatMapper.insert(seat);
            }
        }
        return classroom.getId();
    }

    @Override
    public Boolean update(Long id, ClassroomUpdateDTO request) {
        Classroom existing = classroomMapper.selectById(id);
        if (existing == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "教室不存在");
        }
        if (!StringUtils.hasText(request.getRoomNumber())
                || !StringUtils.hasText(request.getBuilding())
                || !StringUtils.hasText(request.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "教室编号、教学楼和状态不能为空");
        }

        String building = request.getBuilding().trim();
        String roomNumber = request.getRoomNumber().trim();
        String status = request.getStatus().trim();

        checkDuplicate(building, roomNumber, id);
        validateStatus(status);
        validateLayoutCanContainExistingSeats(id, request.getSeatRows(), request.getSeatCols());

        Classroom classroom = new Classroom();
        classroom.setId(id);
        classroom.setRoomNumber(roomNumber);
        classroom.setBuilding(building);
        classroom.setSeatRows(request.getSeatRows());
        classroom.setSeatCols(request.getSeatCols());
        classroom.setStatus(status);
        classroom.setRemark(request.getRemark());

        int rows = classroomMapper.updateById(classroom);
        if (rows < 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "更新失败");
        }
        return true;
    }

    @Override
    public ClassroomVO getClassroomById(Long id) {
        Classroom classroom = classroomMapper.selectById(id);
        if (classroom == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "教室不存在");
        }
        return classroomToClassroomVO(classroom);
    }

    @Override
    public List<String> listBuildings() {
        return classroomMapper.selectDistinctBuildings();
    }

    @Override
    public List<ClassroomVO> getAvailableClassroomList(String building, Integer minCapacity) {
        List<Classroom> classroomList = classroomMapper.selectList(building, minCapacity, ClassroomStatus.ENABLED.name());
        return classroomList.stream().map(this::classroomToClassroomVO).collect(Collectors.toList());
    }

    @Override
    public List<BuildingPreferenceVO> listPreferredBuildings(Long currentUserId) {
        return reservationMapper.selectPreferredBuildingsByUserId(currentUserId);
    }

    @Override
    public List<ClassroomVO> adminGetClassroomList(String building, Integer minCapacity, String status) {
        if (StringUtils.hasText(status)) {
            validateStatus(status);
        }
        return classroomMapper.selectList(building, minCapacity, status).stream()
                .map(this::classroomToClassroomVO)
                .toList();
    }

    private void checkDuplicate(String building, String roomNumber, Long currentId) {
        Classroom duplicate = classroomMapper.selectByBuildingAndNumber(building, roomNumber);
        if (duplicate != null && !duplicate.getId().equals(currentId)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该教学楼下教室名称已存在");
        }
    }

    private void validateLayoutCanContainExistingSeats(Long classroomId, Integer seatRows, Integer seatCols) {
        int maxRowNumber = seatMapper.selectMaxRowNumberByClassroomId(classroomId);
        int maxColNumber = seatMapper.selectMaxColNumberByClassroomId(classroomId);
        if (seatRows < maxRowNumber || seatCols < maxColNumber) {
            throw new BusinessException(ResultCode.BAD_REQUEST,
                    "教室行列数不能小于当前已有座位的最大行列，请先删除或调整超出范围的座位");
        }
    }

    private void validateStatus(String status) {
        if (!ClassroomStatus.ENABLED.name().equals(status)
                && !ClassroomStatus.DISABLED.name().equals(status)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "状态只能是启用或禁用");
        }
    }

    private ClassroomVO classroomToClassroomVO(Classroom classroom) {
        ClassroomVO classroomVO = new ClassroomVO();
        BeanUtils.copyProperties(classroom, classroomVO);
        classroomVO.setCapacity(classroom.getSeatRows() * classroom.getSeatCols());
        return classroomVO;
    }
}
